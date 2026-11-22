const COLS = 21;
const ROWS = 13;
const TICK_MS = 100;
const PLAYER_MOVE_MS = 150;
const PLAYER_SHOT_MS = 400;
const START_LIVES = 3;

const ENEMY_RELOAD = 20; // in ticks
const ENEMY_STEP_TICKS = 5; // how often enemies move on level 1
const ENEMY_MIN_STEP_TICKS = 2;
const FIRST_LEVEL_ENEMIES = 3;
const SPAWN_EVERY = 20;

const POINTS_PER_KILL = 100;
const LEVEL_BONUS = 250;

const SCORES_KEY = "tanks.scores";
const NAME_KEY = "tanks.name";
const MAX_SCORES = 5;
const DEFAULT_NAME = "PLAYER";

// # steel wall, + brick, P player start, E enemy spawn
const MAPS = [
  [
    "#####################",
    "#E.......E.........E#",
    "#...................#",
    "#..++..###.###..++..#",
    "#..++...........++..#",
    "#.......+++++.......#",
    "#..#....+...+....#..#",
    "#.......+++++.......#",
    "#..++...........++..#",
    "#..++..###.###..++..#",
    "#...................#",
    "#.........P.........#",
    "#####################",
  ],
  [
    "#####################",
    "#E........E........E#",
    "#.###.+++...+++.###.#",
    "#...................#",
    "#.++..#.......#..++.#",
    "#.++..#..+++..#..++.#",
    "#.....#..+.+..#.....#",
    "#.++..#..+++..#..++.#",
    "#.++..#.......#..++.#",
    "#...................#",
    "#.###.+++...+++.###.#",
    "#.........P.........#",
    "#####################",
  ],
];

const DIRS = {
  up: { x: 0, y: -1, char: "^" },
  down: { x: 0, y: 1, char: "v" },
  left: { x: -1, y: 0, char: "<" },
  right: { x: 1, y: 0, char: ">" },
};

const KEYS = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

let cells = [];
let map = [];
let player = null;
let enemies = [];
let bullets = [];
let spawns = [];
let playerStart = null;
let enemiesToSpawn = 0;
let level = 1;
let score = 0;
let lives = START_LIVES;
let tickCount = 0;
let timerId = null;
let running = false;
let lastMove = 0;
let lastShot = 0;
let overlayAction = null;

const $ = (id) => document.getElementById(id);


// Saving

function loadScores() {
  try {
    return JSON.parse(localStorage.getItem(SCORES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveScore(name, points, reachedLevel) {
  const scores = loadScores();
  scores.push({ name, score: points, level: reachedLevel });
  scores.sort((a, b) => b.score - a.score);
  localStorage.setItem(SCORES_KEY, JSON.stringify(scores.slice(0, MAX_SCORES)));
}

function clearScores() {
  localStorage.removeItem(SCORES_KEY);
  showHighScores();
}

function loadName() {
  return localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
}

function saveName(name) {
  localStorage.setItem(NAME_KEY, name);
}

function showHighScores() {
  const list = $("highscores");
  const scores = loadScores();

  if (scores.length === 0) {
    list.innerHTML = '<li class="empty">No scores yet</li>';
    return;
  }

  list.innerHTML = "";
  for (const entry of scores) {
    const li = document.createElement("li");
    li.textContent = `${entry.name} - ${entry.score} pts (level ${entry.level})`;
    list.appendChild(li);
  }
}


// Board and drawing

function createBoard() {
  const board = $("board");
  for (let y = 0; y < ROWS; y++) {
    cells.push([]);
    for (let x = 0; x < COLS; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      board.appendChild(cell);
      cells[y].push(cell);
    }
  }
}

function loadLevel() {
  const rows = MAPS[(level - 1) % MAPS.length];
  map = [];
  spawns = [];
  enemies = [];
  bullets = [];

  for (let y = 0; y < ROWS; y++) {
    map.push([]);
    for (let x = 0; x < COLS; x++) {
      const ch = rows[y][x];
      if (ch === "P") playerStart = { x, y };
      if (ch === "E") spawns.push({ x, y });
      map[y].push(ch === "#" || ch === "+" ? ch : ".");
    }
  }

  player = { x: playerStart.x, y: playerStart.y, dir: "up" };
  enemiesToSpawn = FIRST_LEVEL_ENEMIES + level - 1;
  spawns.forEach(spawnEnemy);
}

function draw() {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tile = map[y][x];
      if (tile === "#") drawChar(x, y, "#", "wall");
      else if (tile === "+") drawChar(x, y, "+", "brick");
      else drawChar(x, y, "", "");
    }
  }
  // tanks are drawn last so they cover bullets
  for (const bullet of bullets) drawChar(bullet.x, bullet.y, "*", "bullet");
  for (const enemy of enemies) drawChar(enemy.x, enemy.y, DIRS[enemy.dir].char, "enemy");
  drawChar(player.x, player.y, DIRS[player.dir].char, "player");
}

function drawChar(x, y, char, className) {
  cells[y][x].textContent = char;
  cells[y][x].className = "cell " + className;
}

function updateHUD() {
  $("hud-level").textContent = level;
  $("hud-score").textContent = score;
  $("hud-lives").textContent = lives;
  $("hud-enemies").textContent = enemies.length + enemiesToSpawn;
}


// Tanks

function tankAt(x, y) {
  if (player.x === x && player.y === y) return player;
  return enemies.find((enemy) => enemy.x === x && enemy.y === y);
}

function isFree(x, y) {
  return map[y][x] === "." && !tankAt(x, y);
}

// The tank turns even if it can't move, so you can aim while standing at a wall.
function tryMove(tank, dir) {
  tank.dir = dir;
  const nx = tank.x + DIRS[dir].x;
  const ny = tank.y + DIRS[dir].y;
  if (!isFree(nx, ny)) return false;
  tank.x = nx;
  tank.y = ny;
  return true;
}

function shoot(tank) {
  bullets.push({ x: tank.x, y: tank.y, dir: tank.dir, owner: tank });
}

function randomDir() {
  const dirs = Object.keys(DIRS);
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function hitPlayer() {
  lives--;
  player.x = playerStart.x;
  player.y = playerStart.y;
  player.dir = "up";
  // give the player a moment after respawning
  for (const enemy of enemies) enemy.reload = ENEMY_RELOAD;
}


// Enemies

function spawnEnemy(spawn) {
  if (enemiesToSpawn <= 0 || tankAt(spawn.x, spawn.y)) return;
  enemies.push({
    x: spawn.x,
    y: spawn.y,
    dir: "down",
    // random first reload so they don't all fire together
    reload: ENEMY_RELOAD + Math.floor(Math.random() * ENEMY_RELOAD),
  });
  enemiesToSpawn--;
}

// Head for the player along the longer distance first. If that's blocked,
// try the other axis, and if that's blocked too, a random direction.
function moveEnemy(enemy) {
  const dx = player.x - enemy.x;
  const dy = player.y - enemy.y;
  const horizontal = dx > 0 ? "right" : "left";
  const vertical = dy > 0 ? "down" : "up";
  const choices = Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];
  choices.push(randomDir());

  for (const dir of choices) {
    if (tryMove(enemy, dir)) return;
  }
}

// Enemies only shoot when the player is in the same row or column.
function enemyShoot(enemy) {
  if (enemy.reload > 0) {
    enemy.reload--;
    return;
  }

  if (enemy.x === player.x) enemy.dir = player.y > enemy.y ? "down" : "up";
  else if (enemy.y === player.y) enemy.dir = player.x > enemy.x ? "right" : "left";
  else return;

  shoot(enemy);
  enemy.reload = ENEMY_RELOAD;
}

function enemyStepTicks() {
  return Math.max(ENEMY_MIN_STEP_TICKS, ENEMY_STEP_TICKS - level + 1);
}

function updateEnemies() {
  for (const enemy of enemies) {
    if (tickCount % enemyStepTicks() === 0) moveEnemy(enemy);
    enemyShoot(enemy);
  }

  if (tickCount % SPAWN_EVERY === 0) {
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    spawnEnemy(spawn);
  }
}

function killEnemy(enemy) {
  enemies = enemies.filter((other) => other !== enemy);
  score += POINTS_PER_KILL;
}


// Bullets

// Returns true when the bullet hit something and should disappear.
function bulletHit(bullet) {
  const tile = map[bullet.y][bullet.x];
  if (tile === "#") return true;
  if (tile === "+") {
    map[bullet.y][bullet.x] = ".";
    return true;
  }

  const tank = tankAt(bullet.x, bullet.y);
  if (!tank || tank === bullet.owner) return false;

  if (tank === player) hitPlayer();
  else if (bullet.owner === player) killEnemy(tank);
  // enemies can't hurt each other, the bullet just stops
  return true;
}

function updateBullets() {
  for (const bullet of bullets) {
    // check before moving too, in case a tank drove into the bullet
    if (bulletHit(bullet)) {
      bullet.used = true;
      continue;
    }
    bullet.x += DIRS[bullet.dir].x;
    bullet.y += DIRS[bullet.dir].y;
    if (bulletHit(bullet)) bullet.used = true;
  }
  bullets = bullets.filter((bullet) => !bullet.used);
}


// Game flow

function tick() {
  tickCount++;
  updateBullets();
  updateEnemies();

  if (lives <= 0) {
    gameOver();
  } else if (enemies.length === 0 && enemiesToSpawn === 0) {
    levelCleared();
  } else {
    draw();
    updateHUD();
  }
}

function startLevel() {
  loadLevel();
  tickCount = 0;
  running = true;
  hideOverlay();
  draw();
  updateHUD();
  // pressing Enter on the focused button can start the game twice
  clearInterval(timerId);
  timerId = setInterval(tick, TICK_MS);
}

function stopGame() {
  running = false;
  clearInterval(timerId);
  draw();
  updateHUD();
}

function newGame() {
  const name = $("name-input").value.trim().toUpperCase() || DEFAULT_NAME;
  $("name-input").value = name;
  saveName(name);
  level = 1;
  score = 0;
  lives = START_LIVES;
  startLevel();
}

function nextLevel() {
  level++;
  startLevel();
}

function levelCleared() {
  const bonus = LEVEL_BONUS * level;
  score += bonus;
  stopGame();
  showOverlay(`LEVEL ${level} CLEARED!`, `Bonus +${bonus}. Score: ${score}`, "Next level", nextLevel, false);
}

function gameOver() {
  lives = 0;
  stopGame();
  saveScore($("name-input").value, score, level);
  showHighScores();
  showOverlay("GAME OVER", `You reached level ${level} with ${score} points.`, "Play again", newGame, true);
}


// Overlay and keyboard

function showOverlay(title, text, buttonText, action, showName) {
  $("overlay-title").textContent = title;
  $("overlay-text").textContent = text;
  $("overlay-btn").textContent = buttonText;
  $("name-row").classList.toggle("hidden", !showName);
  $("overlay").classList.remove("hidden");
  overlayAction = action;
}

function hideOverlay() {
  $("overlay").classList.add("hidden");
  document.activeElement.blur();
}

function onKeyDown(event) {
  if (!running) {
    if (event.code === "Enter") {
      event.preventDefault();
      overlayAction();
    }
    return;
  }

  const now = Date.now();
  const dir = KEYS[event.code];

  if (dir) {
    event.preventDefault();
    if (now - lastMove >= PLAYER_MOVE_MS) {
      tryMove(player, dir);
      lastMove = now;
      draw();
    }
  } else if (event.code === "Space") {
    event.preventDefault();
    if (now - lastShot >= PLAYER_SHOT_MS) {
      shoot(player);
      lastShot = now;
    }
  }
}

function init() {
  createBoard();
  $("name-input").value = loadName();
  showHighScores();

  loadLevel();
  draw();
  updateHUD();
  showOverlay("TANKS", "Destroy all the enemy tanks!", "Start game", newGame, true);

  $("overlay-btn").addEventListener("click", () => overlayAction());
  $("clear-btn").addEventListener("click", clearScores);
  document.addEventListener("keydown", onKeyDown);
}

init();
