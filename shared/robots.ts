/**
 * robots.txt, read the standard way (RFC 9309): the group for our user-agent token if there is one, else the "*" group;
 * within it the longest matching Allow or Disallow path wins, Allow on a tie; "*" matches any characters and "$" the end.
 * An empty Disallow allows everything. Pure: no network.
 */
export interface RobotsRule { allow: boolean; path: string }

export function robotsRules(text: string, agentToken: string): RobotsRule[] {
  const token = agentToken.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (key === "disallow" && value === "") continue; // "Disallow:" with nothing = allow all
      current.rules.push({ allow: key === "allow", path: value });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

const matches = (pattern: string, path: string): number => {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path) ? pattern.length : -1;
};

/** Whether `pathAndQuery` (e.g. "/careers?x=1") may be read under these rules. */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best = -1, allow = true;
  for (const r of rules) {
    const n = matches(r.path, pathAndQuery);
    if (n > best || (n === best && n >= 0 && r.allow)) { best = n; allow = r.allow; }
  }
  return allow;
}
