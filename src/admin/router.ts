/** Tiny hash router with :param segments (no dependencies). */

export type RouteParams = Record<string, string>;

export interface RouteMatch {
  handler: (params: RouteParams) => void;
  params: RouteParams;
}

export class HashRouter {
  private routes: { pattern: RegExp; names: string[]; handler: (params: RouteParams) => void }[] = [];

  add(pattern: string, handler: (params: RouteParams) => void): void {
    const names: string[] = [];
    // Accept patterns with or without the leading '#'.
    const clean = pattern.replace(/^#/, "");
    const regex = clean.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      names.push(name);
      return "([^/]+)";
    });
    this.routes.push({ pattern: new RegExp(`^#${regex}$`), names, handler });
  }

  /** Dispatch the current hash; returns true when a route matched. */
  resolve(): boolean {
    const hash = window.location.hash || "#/";
    for (const route of this.routes) {
      const match = hash.match(route.pattern);
      if (match === null) continue;
      const params: RouteParams = {};
      route.names.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      route.handler(params);
      return true;
    }
    return false;
  }

  navigate(hash: string): void {
    window.location.hash = hash;
  }
}
