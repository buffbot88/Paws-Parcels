#!/usr/bin/env python3
"""Deterministic generator for the 75x75 Clover Village map.

Tiles: G grass, P path, F floor, W wall, ~ water, T tree, B bush, X flower.
The village is authored relative to its compact plaza at (37,38): a post
office, shop, four cottages, a north entrance sign, and a southern country
road to the Happy Valley transition at the map edge.
"""
import json, math, random, sys

W = H = 75
rng = random.Random(42)

VILLAGE = (37, 38)       # plaza crossroads
CLEAR_R = 14             # tidy grass radius around the village core
SPARSE_R = 20            # bushes/flowers only between 14 and 20
ROAD_H = 38              # horizontal road row (through the plaza)
ROAD_X = 37              # vertical road column (north + south arms)

grid = [["G"] * W for _ in range(H)]

def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])

def in_clear(x, y):
    return dist((x, y), VILLAGE) < CLEAR_R

# --- forest patches (clustered trees) -------------------------------------
for _ in range(30):
    cx, cy = rng.randint(3, W - 4), rng.randint(3, H - 4)
    r = rng.randint(3, 7)
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            x, y = cx + dx, cy + dy
            if not (3 <= x < W - 3 and 3 <= y < H - 3):
                continue
            if in_clear(x, y):
                continue
            if dx * dx + dy * dy > r * r:
                continue
            if rng.random() < 0.55:
                grid[y][x] = "T"

# --- scattered bushes + flowers -------------------------------------------
for _ in range(230):
    x, y = rng.randint(3, W - 4), rng.randint(3, H - 4)
    if dist((x, y), VILLAGE) < SPARSE_R:
        continue
    if grid[y][x] == "G":
        grid[y][x] = "B"
for _ in range(210):
    x, y = rng.randint(3, W - 4), rng.randint(3, H - 4)
    if dist((x, y), VILLAGE) < SPARSE_R:
        continue
    if grid[y][x] == "G":
        grid[y][x] = "X"

# --- lake (north-west) + small pond ---------------------------------------
def blob(cx, cy, r):
    for dx in range(-r - 1, r + 2):
        for dy in range(-r - 1, r + 2):
            x, y = cx + dx, cy + dy
            if not (3 <= x < W - 3 and 3 <= y < H - 3):
                continue
            d = dist((0, 0), (dx, dy))
            wobble = 0.7 + 0.5 * math.sin(dx * 1.7 + dy * 0.9)
            if d < r * wobble:
                grid[y][x] = "~"
                if d > r * wobble - 1.2:
                    grid[y][x] = "B"  # bushy shore

blob(14, 14, 6)
blob(59, 57, 4)

# --- roads (drawn after scatter so they always carve through) --------------
def hline(y, x0, x1, code="P"):
    for x in range(x0, x1 + 1):
        grid[y][x] = code

def vline(x, y0, y1, code="P"):
    for y in range(y0, y1 + 1):
        grid[y][x] = code

# plaza crossroads
hline(ROAD_H, 13, 61)
vline(ROAD_X, 21, 74)
for y in range(63, 68):
    for x in range(60, 65):
        grid[y][x] = "P"
# southern gateway (wider mouth at the map edge)
for y in range(69, 74):
    for x in range(35, 40):
        grid[y][x] = "P"
# building spurs (post office west, shop east)
vline(29, 31, 38)
vline(45, 31, 38)

# --- buildings (walls + floor + door) --------------------------------------
def building(x0, y0, w, h, door_x, door_y):
    for x in range(x0, x0 + w):
        for y in range(y0, y0 + h):
            if (x == door_x and y == door_y):
                grid[y][x] = "P"  # door
            elif x == x0 or x == x0 + w - 1 or y == y0 or y == y0 + h - 1:
                grid[y][x] = "W"
            else:
                grid[y][x] = "F"

# Post Office (5x5) + Shop (5x5), doors south onto their spurs
building(27, 26, 5, 5, 29, 30)
building(43, 26, 5, 5, 45, 30)
# four cottages (3x3), doors south into the clearing
building(19, 32, 3, 3, 20, 34)
building(55, 32, 3, 3, 56, 34)
building(19, 44, 3, 3, 20, 46)
building(55, 44, 3, 3, 56, 46)
# cottage door spurs — the outer cottages sit past the tidy clearing where
# tree clusters grow, so a spur to the plaza road guarantees each door stays
# reachable no matter how the forest scatters. Drawn AFTER the buildings so
# the spur forms a porch through the door (replaces the south-wall tile).
vline(20, 35, 38)
vline(56, 35, 38)
vline(20, 39, 46)
vline(56, 39, 46)

# --- tree border (3 thick), leaving the southern road open ------------------
for y in range(H):
    for x in range(W):
        if x < 3 or x >= W - 3 or y < 3 or y >= H - 3:
            if grid[y][x] == "~":
                continue
            grid[y][x] = "T"
# carve the southern road + gateway back through the border
for y in range(72, H):
    for x in range(35, 40):
        grid[y][x] = "P"
vline(ROAD_X, 69, 74)

# --- landmark pads: guarantee the exact tiles are walkable ------------------
def pad(pts):
    """Clear stray trees right around landmarks (never touch roads/buildings)."""
    for (x, y) in pts:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and grid[ny][nx] == "T":
                    grid[ny][nx] = "G"

LANDMARKS = [
    (37, 38),    # village spawn (plaza)
    (38, 21),    # welcome sign (beside the north road)
    (32, 38),    # quest board
    (30, 38),    # mailbox
    (49, 38), (25, 38), (37, 32), (37, 46),  # maple/biscuit/lumi/moss
    (20, 34), (56, 34), (20, 46), (56, 46),  # cottage doors
]
pad(LANDMARKS)
# pip + counter inside the post office (already floor) — ensure reachable via door
assert grid[28][29] == "F" and grid[30][29] == "P"

rows = ["".join(row) for row in grid]
assert len(rows) == H and all(len(r) == W for r in rows)

map_data = {
    "id": "zone-clover-village",
    "name": "Clover Village",
    "width": W,
    "height": H,
    "rows": rows,
    "spawn": {"x": 37, "y": 38},
    "transitions": [
        {
            "id": "trans-clover-valley",
            "label": "Happy Valley",
            "x": ROAD_X,
            "y": H - 1,
            "toZone": "zone-happy-valley",
            "spawn": {"x": 20, "y": 1},
        }
    ],
    "interactables": [
        {
            "id": "object-counter",
            "kind": "counter",
            "label": "Post Office Counter",
            "x": 28,
            "y": 28,
            "lines": [
                "The counter is polished and tidy. Deliveries begin here when the postmaster is ready."
            ],
        },
        {
            "id": "object-quest-board",
            "kind": "quest-board",
            "label": "Quest Board",
            "x": 32,
            "y": 38,
            "lines": [
                "A corkboard of quest cards. The newest ones aren't posted yet \u2014 check back soon."
            ],
        },
        {
            "id": "object-mailbox",
            "kind": "mailbox",
            "label": "Mailbox",
            "x": 30,
            "y": 38,
            "lines": [
                "Your little green mailbox. It's empty right now \u2014 nothing to claim yet."
            ],
        },
        {
            "id": "object-shop",
            "kind": "shop",
            "label": "Shop Shelf",
            "x": 44,
            "y": 28,
            "lines": [
                "The shop shelves are stocked with shiny things\u2026 for now."
            ],
        },
        {
            "id": "object-welcome-sign",
            "kind": "sign",
            "label": "Welcome Sign",
            "x": 38,
            "y": 21,
            "lines": [
                "Welcome to Clover Village! Letters, parcels, and very organized hedgehogs."
            ],
        },
    ],
}

with open("/home/opc/AshatPlatform/modules/AshatHub/projects/stressthismess/src/data/maps/clover-village.json", "w") as f:
    json.dump(map_data, f, indent=1)
    f.write("\n")

# --- quick self-check -------------------------------------------------------
COLLIDE = {"W": True, "~": True, "T": True}
def walkable(x, y):
    return 0 <= x < W and 0 <= y < H and not COLLIDE.get(rows[y][x], False)

checks = [
    ("spawn", 37, 38),
    ("transition", 37, 74),
    ("pip", 29, 28),
    ("counter", 28, 28),
    ("shop", 44, 28),
    ("maple", 49, 38),
    ("biscuit", 25, 38),
    ("lumi", 37, 32),
    ("moss", 37, 46),
    ("quest-board", 32, 38),
    ("mailbox", 30, 38),
    ("sign", 38, 21),
    ("po-door", 29, 30),
    ("shop-door", 45, 30),
    ("cottage-NW", 20, 34),
    ("cottage-NE", 56, 34),
    ("cottage-SW", 20, 46),
    ("cottage-SE", 56, 46),
]
bad = [c for c in checks if not walkable(c[1], c[2])]
if bad:
    print("UNWALKABLE:", bad)
    sys.exit(1)

# Connectivity: every landmark (incl. cottage doors) must be reachable from
# the plaza over walkable tiles only — not just locally walkable.
from collections import deque
start = (checks[0][1], checks[0][2])
seen = {start}
queue = deque([start])
while queue:
    cx, cy = queue.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = cx + dx, cy + dy
        if (nx, ny) in seen or not walkable(nx, ny):
            continue
        seen.add((nx, ny))
        queue.append((nx, ny))
unreachable = [c for c in checks if (c[1], c[2]) not in seen]
if unreachable:
    print("UNREACHABLE:", unreachable)
    sys.exit(1)
print("ok — all landmarks walkable and reachable from the plaza")
counts = {c: sum(r.count(c) for r in rows) for c in "GPFW~TBX"}
print("tile counts:", counts)
