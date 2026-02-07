export const EXEC_TOOL_NAME = "exec";
export const EXECUTION_TOOL_NAME = "execution";

const EXEC_PARAMETERS = {
  type: "object",
  properties: {
    /**
     * Preferred form: cmd + args.
     * This is executed without spawning an intermediate shell.
     */
    cmd: {
      type: "string",
      description: "Executable to run (preferred over 'command'). Example: 'git'"
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "Arguments array. Example: ['status', '-sb']"
    },
    /**
     * Power form: a shell command string.
     * This is executed via the user's shell on macOS (zsh -lc). Use with caution.
     */
    command: {
      type: "string",
      description: "Shell command string. More flexible but less safe. Example: 'ls -la | sed -n 1,50p'"
    },
    cwd: {
      type: "string",
      description: "Working directory, relative to the project root. Default: '.'"
    },
    timeoutMs: {
      type: "number",
      description: "Execution timeout in milliseconds. Default: 60000"
    },
    maxStdoutBytes: {
      type: "number",
      description: "Max stdout bytes to capture before truncating. Default: 200000"
    },
    maxStderrBytes: {
      type: "number",
      description: "Max stderr bytes to capture before truncating. Default: 200000"
    },
    env: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Extra environment variables to set for the command."
    }
  },
  additionalProperties: false
} as const;

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: EXEC_TOOL_NAME,
      description:
        "Execute a command on the local machine. Prefer 'cmd'+'args' for safety. Returns stdout/stderr/exitCode.",
      parameters: EXEC_PARAMETERS
    }
  },
  {
    type: "function",
    function: {
      name: EXECUTION_TOOL_NAME,
      description:
        "Alias of 'exec'. Execute a command on the local machine. Prefer 'cmd'+'args' for safety.",
      parameters: EXEC_PARAMETERS
    }
  }
] as const;
