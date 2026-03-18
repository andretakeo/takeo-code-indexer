import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { SKILLS } from "./skills.js";

export async function writeSkills(targetDir: string): Promise<string[]> {
  const written: string[] = [];

  for (const skill of SKILLS) {
    const skillDir = join(targetDir, skill.dirName);
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, "skill.md");
    await writeFile(skillFile, skill.content, "utf-8");
    written.push(skillFile);
  }

  return written;
}

async function promptLocation(): Promise<"global" | "local"> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question(
      `${chalk.bold("Where should the skills be installed?")}\n` +
        `  ${chalk.cyan("1)")} Global  ${chalk.dim(`(~/.claude/skills/)`)}\n` +
        `  ${chalk.cyan("2)")} Local   ${chalk.dim(`(.claude/skills/ in current project)`)}\n` +
        `\nChoice (1/2): `,
    );

    const trimmed = answer.trim();
    if (trimmed === "2" || trimmed.toLowerCase() === "local") {
      return "local";
    }
    return "global";
  } finally {
    rl.close();
  }
}

export function resolveSkillsDir(
  location: "global" | "local",
  cwd: string,
): string {
  if (location === "global") {
    return join(homedir(), ".claude", "skills");
  }
  return join(cwd, ".claude", "skills");
}

export async function installAction(opts: {
  global?: boolean;
  local?: boolean;
}): Promise<void> {
  try {
    let location: "global" | "local";

    if (opts.global) {
      location = "global";
    } else if (opts.local) {
      location = "local";
    } else {
      location = await promptLocation();
    }

    const targetDir = resolveSkillsDir(location, process.cwd());

    console.log();
    console.log(
      chalk.dim(`  Installing to ${targetDir}`),
    );
    console.log();

    const written = await writeSkills(targetDir);

    for (const filePath of written) {
      console.log(`  ${chalk.green("✓")} ${filePath}`);
    }

    console.log();
    console.log(
      chalk.bold(`  ${written.length} skills installed successfully!`),
    );
    console.log();
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
