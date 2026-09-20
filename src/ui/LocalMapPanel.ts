import type { MapData } from "../game/Maps.ts";

const mapAssets = import.meta.glob(
  "../../design/CloverVillage.png",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;
const CLOVER_VILLAGE_IMAGE = Object.values(mapAssets)[0] ?? "";

/** Full-screen local map: solid parchment content over a softly revealed world. */
export class LocalMapPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly mapImage: HTMLImageElement;
  private readonly locations: HTMLElement;
  private openState = false;

  constructor() {
    const root = document.createElement("section");
    root.className = "local-map-panel";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Local map");

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "local-map-panel__backdrop";
    backdrop.setAttribute("aria-label", "Close map");
    backdrop.addEventListener("click", () => this.close());

    const shell = document.createElement("div");
    shell.className = "local-map-panel__shell";

    const header = document.createElement("header");
    header.className = "local-map-panel__header";
    const heading = document.createElement("div");
    const brand = document.createElement("span");
    brand.className = "local-map-panel__eyebrow";
    brand.textContent = "PAWS & PARCELS  ·  FIELD GUIDE";
    const title = document.createElement("h1");
    title.className = "local-map-panel__title";
    title.textContent = "Local Map";
    const subtitle = document.createElement("p");
    subtitle.className = "local-map-panel__subtitle";
    subtitle.textContent = "Clover Village";
    this.title = title;
    this.subtitle = subtitle;
    heading.append(brand, title, subtitle);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "local-map-panel__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close map");
    close.addEventListener("click", () => this.close());
    header.append(heading, close);

    const body = document.createElement("div");
    body.className = "local-map-panel__body";

    const sidebar = document.createElement("aside");
    sidebar.className = "local-map-panel__sidebar";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "local-map-panel__search";
    search.placeholder = "Search locations…";
    search.setAttribute("aria-label", "Search locations");
    const locationList = document.createElement("div");
    locationList.className = "local-map-panel__locations";
    this.locations = locationList;
    sidebar.append(search, locationList);

    const mapFrame = document.createElement("main");
    mapFrame.className = "local-map-panel__map-frame";
    const mapLabel = document.createElement("div");
    mapLabel.className = "local-map-panel__map-label";
    mapLabel.innerHTML = "<strong>✦ Clover Village</strong><span>Kind people · brighter tomorrows</span>";
    const image = document.createElement("img");
    image.className = "local-map-panel__map-image";
    image.alt = "Illustrated map of Clover Village";
    if (CLOVER_VILLAGE_IMAGE !== "") image.src = CLOVER_VILLAGE_IMAGE;
    image.addEventListener("error", () => image.hidden = true);
    const fallback = document.createElement("div");
    fallback.className = "local-map-panel__map-fallback";
    fallback.textContent = "Clover Village map is being unfolded…";
    mapFrame.append(mapLabel, image, fallback);
    this.mapImage = image;

    const details = document.createElement("aside");
    details.className = "local-map-panel__details";
    details.innerHTML = `
      <span class="local-map-panel__eyebrow">CURRENT AREA</span>
      <h2>Post Office</h2>
      <p class="local-map-panel__chips"><span>🏠 Main Hub</span><span>🛡 Safe Zone</span></p>
      <p>The heart of Clover Village. Drop off deliveries, pick up new requests, and meet friendly faces from around town.</p>
      <hr>
      <strong>Available here</strong>
      <ul><li>👥 NPCs <b>6</b></li><li>❕ Quests <b>5</b></li><li>✉ Deliveries <b>8</b></li><li>🏪 Shops <b>1</b></li></ul>
      <button class="local-map-panel__waypoint" type="button" disabled title="Waypoint support is not implemented yet">⌖ Set Waypoint — Coming Soon</button>
    `;

    body.append(sidebar, mapFrame, details);
    const footer = document.createElement("footer");
    footer.className = "local-map-panel__footer";
    footer.innerHTML = "<span>Location details are informational while map interaction is in development.</span><span><kbd>M</kbd> Close map</span>";
    shell.append(header, body, footer);
    root.append(backdrop, shell);
    document.getElementById("hud-overlays")?.appendChild(root);
    this.root = root;

    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      locationList.querySelectorAll<HTMLElement>("button").forEach((item) => {
        item.hidden = query !== "" && !item.textContent!.toLowerCase().includes(query);
      });
    });
    document.addEventListener("keydown", this.handleKeyDown);
  }

  attach(map: MapData): void {
    this.title.textContent = "Local Map";
    this.subtitle.textContent = map.name;
    this.locations.replaceChildren();
    const entries = [
      ["🏠", "Post Office"], ["☕", "Café Biscuit"], ["🌸", "Willow & Bloom"],
      ["⚗", "Lumi’s Research Shop"], ["🏪", "Market Square"], ["🚪", "Village Exit"],
    ];
    for (const [icon, label] of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "local-map-panel__location";
      item.innerHTML = `<span>${icon}</span><strong>${label}</strong>`;
      this.locations.appendChild(item);
    }
  }

  toggle(): void { if (this.openState) this.close(); else this.open(); }

  open(): void {
    this.openState = true;
    this.root.hidden = false;
    document.body.classList.add("map-open");
    this.root.querySelector<HTMLElement>(".local-map-panel__close")?.focus();
  }

  close(): void {
    this.openState = false;
    this.root.hidden = true;
    document.body.classList.remove("map-open");
  }

  isOpen(): boolean { return this.openState; }

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.body.classList.remove("map-open");
    this.root.remove();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== "m") return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    this.toggle();
  };
}
