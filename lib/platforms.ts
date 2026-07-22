export interface Platform {
  id: string;
  name: string;
  available: boolean;
}

export const platforms: Platform[] = [
  { id: "claude-code", name: "Claude Code", available: true },
  { id: "cursor", name: "Cursor", available: false },
  { id: "cline", name: "Cline", available: false },
  { id: "continue", name: "Continue", available: false },
  { id: "gemini-cli", name: "Gemini CLI", available: false },
  { id: "codex", name: "OpenAI Codex", available: false },
  { id: "windsurf", name: "Windsurf", available: false },
];

export const DEFAULT_PLATFORM_ID = "claude-code";
