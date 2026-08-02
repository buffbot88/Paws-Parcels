/**
 * Installs lightweight global error logging for the game.
 * Phase 1 deliverable — logs runtime errors and unhandled rejections to the console.
 */
export function initErrorLogging(): void {
  window.addEventListener("error", (event) => {
    console.error("[Paws&Parcels] Uncaught error:", event.message, event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Paws&Parcels] Unhandled promise rejection:", event.reason);
  });
}
