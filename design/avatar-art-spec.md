# Avatar art spec — new animal couriers

The playable couriers are drawn from three authored bodies (bear, cat, fox) in
`reference/assets/Classes/<Warrior|Mage|Archer>/`. Every other species
(`src/data/species.json`) is a recolour of one of those bodies until it has
its own art. This file is the brief for generating that art so it drops in
with the same frame layout.

## Generator settings (match the existing couriers exactly)

| Setting | Value |
| --- | --- |
| Template | `mannequin` |
| Canvas | 36 × 36 px |
| View | low top-down |
| Directions | 4 (south, west, east, north) |
| Style prompt suffix | `cute chibi, courier outfit, clean 1px dark outline, flat shading, 3–4 tones per colour` |

### Animations (names and frame counts must match)

| Folder | Frames per direction |
| --- | --- |
| `Idle/rotations/<dir>.png` | 1 (the idle pose) |
| `Idle/animations/Walk/<dir>/frame_000..005.png` | 6 |
| `Idle/animations/Lead_Jab/<dir>/frame_000..002.png` | 3 |
| `Idle/animations/Picking_Up/<dir>/frame_000..004.png` | 5 |
| `Idle/animations/Falling_Back_Death/<dir>/frame_000..006.png` | 7 |

Keep the figure's feet 11–13 px below the canvas centre and the figure 25–28 px
tall, like the current three, so sizing and shadows line up.

## Colour rules (so the Salon can recolour parts)

The Salon recolours by *colour family*, not by mask. For each species, draw
each part in its own clearly separated colour family:

- **Fur** — the main coat: one hue, 3–4 tones.
- **Markings** — belly, muzzle, inner ears, tail tip: a light, low-contrast hue
  distinct from the fur (cream/white works for most animals).
- **Eyes** — a saturated hue used nowhere else (blue, cyan or violet).
- **Outfit** — the courier suit: dark, low-saturation (charcoal/navy).
- **Trim** — straps, scarf, gloves: a saturated red/gold used nowhere else.
- **Outline** — near-black, only on the silhouette edge.

Do not draw clothing in the fur colour (the cat's suit is, which is why cat
species cannot recolour an outfit), and keep props (bows, staffs) out of the
fur hue.

## Per-species prompts

Use `Cute Chibi <Animal> Courier` plus the suffix above, with these notes:

| Species id | Prompt notes |
| --- | --- |
| `rabbit` | long upright ears, round tail, cream markings |
| `raccoon` | grey coat, black eye mask, ringed tail |
| `red-panda` | russet coat, white face markings, ringed tail |
| `panda` | white coat, black ears / eye patches / limbs |
| `wolf` | grey coat, pale chest, pointed ears, bushy tail |
| `deer` | tan coat, white spots, small antlers |
| `hedgehog` | brown spines on back, cream face |
| `otter` | brown sleek coat, pale muzzle, thick tail |
| `mouse` | grey coat, big round ears, pink inner ears, thin tail |
| `capybara` | brown blocky body, small ears, no tail |
| `owl` | round feathered body, big eyes, ear tufts |
| `frog` | green, big eyes on top of head, pale belly |

Rabbit, deer, hedgehog, otter, owl and frog are hidden until their art
exists: their silhouettes cannot come from a recolour.

## Dropping art in

1. Export into `reference/assets/Species/<species-id>/` with the folder layout
   above plus the generator's `metadata.json`.
2. Hand it over: wiring a new body takes a loader entry
   (`src/game/classAssets.ts`), its colour-family rules and reference tones
   (`src/game/avatarPalette.ts`), a `BODY_PARTS` row
   (`src/game/appearance.ts`), a sizing row (`src/game/entitySizing.ts`), and
   pointing the species at it in `src/data/species.json`.

## Villager art (NPCs)

Villagers are drawn from the courier bodies in their own colours (`look` in
`src/data/npcs.json`) until they have their own art. Generate them with the
same settings and animations as the couriers, and give each a signature prop
so they read at a glance:

| NPC | Species | Prompt notes |
| --- | --- | --- |
| Pip | hedgehog | post office assistant, blue postal cap and satchel, brown spines |
| Maple | deer | shy florist, tan coat with white spots, green apron, flower in hand |
| Biscuit | bear | cheerful café owner, honey-brown, cream apron, teacup |
| Lumi | moth | mysterious forest researcher, pale lavender wings, round glasses, notebook |
| Moss | frog | sleepy gardener, green, straw hat, watering can |
| Fern | poodle | salon stylist, pink curly coat, purple smock, comb |

Dropping villager art in follows the same steps as a new courier body; then
point the NPC's `look.body` at the new body.

