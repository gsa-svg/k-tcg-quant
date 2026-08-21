"use strict";

function parseGroups(content) {
  const groups = [];
  let agents = [], rules = [];
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) { flush(); continue; }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if (agents.length && (key === "allow" || key === "disallow")) {
      rules.push({ key, value });
    }
  }
  flush();
  return groups;
}

/** Evaluate the longest matching robots rule for the requested agent and path. */
function robotsPolicy(content) {
  const groups = parseGroups(content);
  return {
    isAllowed(agent, pathName) {
      const normalized = agent.toLowerCase();
      const specific = groups.filter((group) => group.agents.includes(normalized));
      const selected = specific.length ? specific : groups.filter((group) => group.agents.includes("*"));
      const matches = selected.flatMap((group) => group.rules)
        .filter((rule) => rule.value && pathName.startsWith(rule.value))
        .sort((a, b) => b.value.length - a.value.length || (a.key === "allow" ? -1 : 1));
      return !matches.length || matches[0].key === "allow";
    },
  };
}

module.exports = { robotsPolicy };
