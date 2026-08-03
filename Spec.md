> ## 🗃 ARCHIVED — HISTORICAL DOCUMENT (non-authoritative)
>
> This is the **original single-player product specification**, preserved for history.
> It was superseded on **2026-08-03 (Phase 3.5 documentation pivot)** by the current
> [`BuildPlan.md`](BuildPlan.md) and the design docs under [`design/`](design/).
>
> **Do not use this as a current spec.** The game is now an online 2.5D MMORPG-lite
> with server-authoritative state, MySQL persistence, three classes, combat, monsters,
> quest chains, gated deliveries, dungeons, and crafting. Items marked "Explicitly Out
> of Scope" (multiplayer, combat, cloud accounts, online database) are now **in scope**.
> Status marker: 🗃 archived

Product Specification: Paws & Parcels (ARCHIVED — single-player)
1. Game Overview
Paws & Parcels is a cozy, cute, browser-based 2D RPG where players become a tiny animal courier in a magical forest.

Players deliver letters and packages, explore charming woodland areas, collect resources, help forest residents, and build friendships. The game should feel relaxing, cheerful, and low-pressure rather than combat-focused.

Genre
Cozy RPG
Exploration and light questing
Collection and relationship simulation
Platform
Modern desktop and mobile browsers
Responsive layout
No installation required
Target Audience
Casual players
Fans of cozy games and life simulations
Players who enjoy exploration, collecting, customization, and character relationships
2. Design Pillars
Cozy first
No harsh penalties, forced timers, or stressful failure states.

Small adventures with meaningful rewards
Every delivery, discovery, and conversation should contribute to progression.

Cute and expressive characters
Characters should have memorable designs, distinct personalities, and playful dialogue.

Simple to learn
Players should understand movement, interaction, deliveries, and inventory within the first few minutes.

A world worth revisiting
New paths, dialogue, items, and upgrades should gradually unlock across familiar areas.

3. Core Gameplay Loop
Visit the forest post office.
Accept delivery requests and optional errands.
Explore nearby zones.
Talk to characters and locate delivery destinations.
Gather berries, herbs, shells, and other resources.
Complete deliveries.
Earn Stamps, friendship points, and items.
Spend rewards on upgrades, cosmetics, and decorations.
Return the next day for new quests and dialogue.
4. Player Character
The player controls a customizable small animal courier.

Available Starter Animals
Cat
Bunny
Fox
Bear cub
Mouse
Customization
Fur or body color
Eye color
Name
Starter accessory
Optional pronouns
Player Stats
Stat	Description
Speed	Determines movement speed
Bag Capacity	Determines how many items can be carried
Delivery Rank	Unlocks better quests and new areas
Friendship	Shared progression with individual NPC relationships
5. World
Main Hub: Clover Post Office
The central safe area where players can:

Accept deliveries
Check their mailbox
View quests
Buy upgrades
Change cosmetics
Talk to the postmaster
Save progress
Exploration Zones
Bramble Patch
A beginner-friendly meadow filled with:

Berry bushes
Flower fields
Rabbit burrows
Small ponds
Easy delivery routes
Whispering Pines
A wooded area with:

Hidden paths
Mushrooms
Fallen logs
Owl and squirrel characters
More complex routes
Sunlit Clearing
A bright open area containing:

Rare flowers
A picnic spot
Seasonal events
The town café
Advanced delivery destinations
6. Quest System
Delivery Quests
Each quest includes:

Sender
Recipient
Package or letter
Destination
Reward
Optional flavor text
Example:

A Warm Letter for Maple
Deliver a letter from Pip the Hedgehog to Maple the Deer before sunset.
Reward: 15 Stamps and +1 Maple Friendship.

Quest Types
Standard delivery
Multi-stop delivery
Lost item recovery
Resource gathering
Character errands
Seasonal event quests
Daily Quests
Each in-game day generates:

3 standard deliveries
1 optional gathering quest
1 friendship-related activity
Daily quests should be randomized from predefined content pools while avoiding impossible combinations.

Quest Completion
A quest is completed when the player:

Has the required item.
Reaches the correct NPC or location.
Interacts with the recipient.
Confirms the delivery.
7. Friendship System
Players can build relationships with forest residents through:

Deliveries
Conversations
Gifts
Completing personal errands
Participating in events
Friendship Levels
Level	Unlock
0 — Stranger	Basic dialogue
1 — Acquaintance	New daily conversation
2 — Friend	Personal side quest
3 — Close Friend	Character story scene
4 — Best Friend	Special gift or cosmetic
Each NPC should have:

Name
Species
Personality
Favorite items
Friendship level
Dialogue sets
Personal quest chain
Portrait and overworld sprite
Initial NPCs
Pip, an energetic hedgehog post assistant
Maple, a shy deer florist
Biscuit, a cheerful bear café owner
Lumi, a mysterious moth who studies the forest
Moss, a sleepy frog gardener
8. Inventory and Items
Inventory Categories
Active deliveries
Gathered resources
Gifts
Quest items
Cosmetics
Upgrade materials
Example Items
Item	Category	Use
Strawberry	Resource	Gift or quest ingredient
Moonflower	Resource	Rare gift
Polished Pebble	Gift	Popular with Moss
Tiny Parcel	Delivery	Required for quests
Cozy Scarf	Cosmetic	Player customization
Golden Acorn	Quest Item	Used in a story quest
Inventory Rules
Inventory starts with 12 slots.
Bag upgrades increase capacity by 6 slots.
Delivery items cannot be discarded while their quest is active.
Items display name, icon, description, and quantity.
9. Progression and Economy
Currency: Stamps
Players earn Stamps by:

Completing deliveries
Finishing errands
Finding hidden collectibles
Participating in events
Stamp Uses
Bag upgrades
Movement upgrades
Cosmetics
Post office decorations
Gift-wrapping supplies
Unlocking optional convenience features
Upgrade Examples
Upgrade	Effect
Bigger Satchel	+6 inventory slots
Comfy Boots	Increased movement speed
Express Badge	Unlocks additional delivery quests
Weatherproof Bag	Prevents delivery items from being affected by weather events
The economy should not require grinding. Core areas and story content should be accessible through normal play.

10. Controls
Desktop
WASD / Arrow Keys: Move
Space / E: Interact
I: Open inventory
J: Open journal
Esc: Close menu or pause
Mobile
Virtual movement pad
On-screen interact button
Touch-friendly menus
Tap-to-select quest and inventory items
Optional Mouse Controls
Click a nearby location to move
Click characters or objects to interact
11. User Interface
Main Menu
New Game
Continue
Settings
Credits
Delete Save
Gameplay HUD
Current quest
Stamp count
Time or day indicator
Interaction prompt
Optional minimap toggle
Journal
Tabs:

Active quests
Completed quests
NPC relationships
Discovered items
World map
Tutorial reminders
Dialogue Window
Character portrait
Name label
Dialogue text
Continue button
Optional auto-advance mode
Text speed setting
Shop Screen
Item categories
Item cost
Purchase confirmation
Current Stamp balance
12. Art Direction
Visual Style
Soft pastel color palette
Rounded shapes
Expressive animal characters
Cozy 2D top-down environments
Light pixel-art or hand-drawn vector style
Technical Art Guidelines
32×32 or 48×48 base tile grid
Clear silhouettes for characters and objects
Animated idle states
Simple walking animations
Distinct icons for all items
Weather and lighting changes for atmosphere
Animation Priorities
Character idle and walk cycles
Mailbox opening
Item pickup
Delivery handoff
Friendship level-up
Confetti or sparkle effects for rewards
13. Audio Direction
Music
Gentle acoustic loops
Light chiptune melodies
Different themes for each zone
Seasonal music variations
Sound Effects
Footsteps by terrain
Soft interaction sounds
Mailbox chime
Item pickup sparkle
Quest completion jingle
UI clicks and menu sounds
Players must be able to control music and sound effects independently.

14. Accessibility
Keyboard support
Touch support
Adjustable text size
High-contrast UI mode
Colorblind-friendly item indicators
Text speed controls
Dialogue auto-advance option
Music, SFX, and master volume controls
No mandatory reaction-time challenges
No permanent failure states
Reduced-motion option
Clear focus states for keyboard navigation
Important information must not be communicated by color alone.

15. Save System
MVP
Use browser-based local saving with:

localStorage for simple save data
IndexedDB if inventory, settings, or content becomes larger
Save Data

{
  "player": {
    "name": "Mochi",
    "animal": "bunny",
    "speedLevel": 1,
    "bagLevel": 1,
    "stamps": 125
  },
  "friendships": {
    "pip": 2,
    "maple": 1
  },
  "inventory": [
    {
      "itemId": "strawberry",
      "quantity": 4
    }
  ],
  "quests": {
    "active": [],
    "completed": []
  },
  "world": {
    "unlockedZones": ["post-office", "bramble-patch"],
    "currentDay": 3
  },
  "settings": {
    "musicVolume": 0.7,
    "sfxVolume": 0.8,
    "textSpeed": "normal"
  }
}
The game should autosave after:

Quest completion
Purchases
Friendship changes
Zone changes
Manual save action
16. Technical Requirements
Recommended Stack
Frontend: TypeScript
Game rendering: Phaser.js, Kaboom.js, or HTML5 Canvas
Interface: HTML/CSS overlay for menus and dialogue
Build tool: Vite
Persistence: localStorage or IndexedDB
Deployment: Static web hosting
Performance Goals
Initial load under 5 seconds on a typical broadband connection
Target 60 FPS on desktop
Target 30–60 FPS on modern mobile devices
Optimized sprite and audio assets
Lazy-load later zones when possible
Responsive Requirements
Desktop and mobile layouts
Minimum supported width: 320px
Menus usable with touch
Game viewport scales without distorting important UI
Portrait and landscape mobile support where practical
17. MVP Scope
The first playable release must include:

Player character selection
One central post office hub
Two exploration zones
Basic movement and interaction
5 NPCs
10–15 delivery quests
Basic gathering
Inventory system
Stamp currency
Three player upgrades
Friendship meters
Dialogue system
Local save system
Desktop and mobile controls
Settings and accessibility options
Explicitly Out of Scope for MVP
Multiplayer
Combat
Cloud accounts
Procedural world generation
Housing customization
Complex crafting
Voice acting
Large open-world map
Real-money purchases
18. Success Criteria
The MVP is successful if:

A new player can understand the controls within five minutes.
Players can complete a full delivery without external instructions.
The game saves and restores progress reliably.
All core screens work on desktop and mobile.
The player can complete at least one meaningful NPC friendship progression.
The game maintains a calm, welcoming tone.
Players have a clear reason to return for another in-game day.
19. Future Roadmap
Version 1.1 — More Stories
Additional NPCs
More personal quest chains
New dialogue and friendship scenes
Version 1.2 — Crafting
Combine resources into gifts
Cook simple recipes
Create special delivery packages
Version 1.3 — Home Customization
Unlock a small player room
Place furniture and decorations
Display collected items
Version 1.4 — Seasonal Events
Spring flower festival
Summer picnic
Autumn lantern walk
Winter gift exchange
Version 1.5 — Cloud Saves
Optional account system
Cross-device progress
Backup and restore support
20. MVP Acceptance Checklist
 Player can start a new game.
 Player can choose and name an animal character.
 Player can move using keyboard controls.
 Player can interact with NPCs and objects.
 Player can accept and complete a delivery.
 Completed quests reward Stamps.
 Resources can be collected and stored.
 Inventory displays item quantities correctly.
 Friendship values increase after relevant actions.
 At least one upgrade can be purchased.
 Game progress persists after refreshing the browser.
 Game can be played on a mobile viewport.
 Audio and text settings work correctly.
 No quest can permanently block player progress.