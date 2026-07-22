/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "builtin" | "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	/** Fallback model for this agent from frontmatter (overridable via a tool call) */
	model?: string;
	/** Fallback thinking level for this agent from frontmatter */
	thinking?: string;
	/** Task categories this agent is optimized for. Helps the parent LLM choose the right agent + model. */
	taskCategories?: string[];
	/** Default spawn mode for this agent ("full" or "lean"). Overridable via the tool-call `spawnMode` parameter. */
	spawnMode?: "full" | "lean";
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

/**
 * Built-in agents always available regardless of .md agent files.
 * Like OpenCode's "general" subagent - no config file needed.
 * User/project agents with the same name override built-in ones.
 */
const BUILTIN_AGENTS: AgentConfig[] = [
	{
		name: "general",
		description:
			"General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
		taskCategories: [
			"refactoring",
			"implementation",
			"debugging",
			"complex analysis",
			"multi-step automation",
			"code generation",
			"research",
		],
		systemPrompt: `You are a general-purpose subagent with an isolated context window. Work autonomously to complete your task.

Guidelines:
- Use all available tools as needed
- Be thorough: investigate, plan, execute, verify
- Execute multiple steps in sequence
- Keep output focused on the task result
- Do not ask the parent for clarification unless absolutely blocked`,
		source: "builtin",
		filePath: "(builtin)",
	},
	{
		name: "explore",
		description:
			"Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. \"src/components/**/*.tsx\"), search code for keywords (eg. \"API endpoints\"), or answer questions about the codebase (eg. \"how do API endpoints work?\"). When calling this agent, specify the desired thoroughness level: \"quick\" for basic searches, \"medium\" for moderate exploration, or \"very thorough\" for comprehensive analysis across multiple locations and naming conventions.",
		tools: ["read", "grep", "find", "ls", "bash"],
		spawnMode: "lean",
		taskCategories: [
			"code exploration",
			"file discovery",
			"pattern search",
			"codebase overview",
			"dependency analysis",
			"read-only investigation",
		],
		systemPrompt: `You are a file search specialist. You excel at thoroughly navigating and exploring codebases. Your strengths:
- Rapidly finding files using patterns
- Searching code and text with powerful regex
- Reading and analyzing file contents

Guidelines:
- Use find, ls for directory structure navigation
- Use grep for searching file contents
- Use read when you know the specific file path
- Use bash for read-only operations: listing, counting, checking file stats (never modify files)
- Adapt your search approach based on the thoroughness level: "quick" = basic search, "medium" = moderate exploration, "very thorough" = comprehensive analysis
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do NOT create, edit, or delete any files`,
		source: "builtin",
		filePath: "(builtin)",
	},
];

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);

		const taskCategories = frontmatter.taskCategories
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);

		// Parse spawnMode / spawn_mode from frontmatter
		const rawSpawnMode = (frontmatter.spawnMode || frontmatter.spawn_mode || "").trim().toLowerCase();
		const spawnMode = (rawSpawnMode === "lean" || rawSpawnMode === "full") ? rawSpawnMode as "lean" | "full" : undefined;

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model || undefined,
			thinking: frontmatter.thinking || undefined,
			taskCategories: taskCategories && taskCategories.length > 0 ? taskCategories : undefined,
			spawnMode,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	// Built-in agents go in first (lowest priority)
	for (const agent of BUILTIN_AGENTS) {
		agentMap.set(agent.name, agent);
	}

	// User/project agents override built-in with same name
	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	// Sort deterministically for prompt-cache stability. The same set of
	// agents should always produce the same description/guideline text.
	const agents = Array.from(agentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	return { agents, projectAgentsDir };
}
