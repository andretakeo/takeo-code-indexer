#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";
import { loadConfig } from "../utils/config.js";
import { createEmbeddingProvider } from "../embeddings/index.js";
import { createStore } from "../store/index.js";
import { Indexer } from "../indexer/indexer.js";
import { formatScore, discoverFiles } from "../utils/helpers.js";
import { installAction } from "./install.js";
import { minimatch } from "minimatch";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const program = new Command();

program
  .name("code-indexer")
  .description("Semantic code search powered by embeddings")
  .version("0.1.0");

// ── index command ────────────────────────────────────────────────────────────

program
  .command("index")
  .description("Index the current codebase")
  .option("-d, --dir <path>", "Root directory to index", ".")
  .option("--fresh", "Drop existing index and re-index from scratch")
  .action(async (opts) => {
    const rootDir = resolve(opts.dir);
    const spinner = ora("Loading config…").start();

    try {
      const config = await loadConfig(rootDir);
      const embedder = createEmbeddingProvider(config.embedding);
      const store = createStore(config.store, rootDir);

      const indexer = new Indexer({
        config,
        embeddingProvider: embedder,
        store,
        rootDir,
        fresh: opts.fresh ?? false,
        onProgress: (msg) => {
          spinner.text = msg;
        },
      });

      const stats = await indexer.index();
      spinner.succeed("Indexing complete!");

      console.log();
      console.log(chalk.bold("  Index Stats"));
      console.log(`  Files found:      ${chalk.cyan(stats.filesFound)}`);
      console.log(`  Files added:      ${chalk.green(stats.filesAdded)}`);
      console.log(`  Files updated:    ${chalk.yellow(stats.filesUpdated)}`);
      console.log(`  Files skipped:    ${chalk.dim(stats.filesSkipped)}`);
      console.log(`  Files removed:    ${chalk.red(stats.filesRemoved)}`);
      console.log(`  Chunks generated: ${chalk.cyan(stats.chunksGenerated)}`);
      console.log(`  Chunks indexed:   ${chalk.cyan(stats.chunksIndexed)}`);
      console.log(
        `  Duration:         ${chalk.cyan(`${(stats.durationMs / 1000).toFixed(1)}s`)}`,
      );
      console.log();
    } catch (err) {
      spinner.fail("Indexing failed");
      if (err instanceof Error) {
        console.error(chalk.red(err.message || err.name));
        if (err.cause) console.error(chalk.dim(String(err.cause)));
      } else {
        console.error(chalk.red(String(err)));
      }
      process.exit(1);
    }
  });

// ── search command ───────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search the indexed codebase")
  .option("-n, --limit <number>", "Max results", "5")
  .option("-d, --dir <path>", "Project root (for config loading)", ".")
  .action(async (query, opts) => {
    const rootDir = resolve(opts.dir);
    const limit = parseInt(opts.limit, 10);

    try {
      const config = await loadConfig(rootDir);
      const embedder = createEmbeddingProvider(config.embedding);
      const store = createStore(config.store, rootDir);

      await store.initialize(embedder.dimensions);

      const indexer = new Indexer({
        config,
        embeddingProvider: embedder,
        store,
        rootDir,
      });

      const spinner = ora("Searching…").start();
      const results = await indexer.search(query, limit);
      spinner.stop();

      if (results.length === 0) {
        console.log(chalk.yellow("No results found."));
        return;
      }

      console.log(
        chalk.bold(`\n  Found ${results.length} results for: "${query}"\n`),
      );

      for (const [i, result] of results.entries()) {
        const { chunk, score } = result;
        const scoreColor = score > 0.8 ? chalk.green : score > 0.6 ? chalk.yellow : chalk.red;

        console.log(
          chalk.bold(`  ${i + 1}. `) +
            chalk.cyan(chunk.filePath) +
            chalk.dim(`:${chunk.startLine}-${chunk.endLine}`) +
            `  ${scoreColor(formatScore(score))}`,
        );
        console.log(chalk.dim(`     ${chunk.language}`));

        // Show a preview (first 3 lines)
        const preview = chunk.content
          .split("\n")
          .slice(0, 3)
          .map((l) => `     ${chalk.dim(l)}`)
          .join("\n");
        console.log(preview);
        console.log();
      }
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── status command ───────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show index status and config")
  .option("-d, --dir <path>", "Project root (for config loading)", ".")
  .action(async (opts) => {
    const rootDir = resolve(opts.dir);

    try {
      const config = await loadConfig(rootDir);
      const store = createStore(config.store, rootDir);

      // Discover files on disk
      const discoverableFiles = await discoverFiles(rootDir, config);

      let vectorCount: number | string;
      let indexedFileCount: number | string;
      let coverage: string;
      try {
        await store.initialize(config.embedding.dimensions ?? 1536);
        vectorCount = await store.count();
        const indexedFiles = await store.getIndexedFilePaths();
        indexedFileCount = indexedFiles.length;
        const pct = discoverableFiles.length > 0
          ? (indexedFiles.length / discoverableFiles.length * 100)
          : 0;
        coverage = `${pct.toFixed(1)}%`;
      } catch {
        vectorCount = chalk.red("unreachable") as string;
        indexedFileCount = chalk.red("unreachable") as string;
        coverage = chalk.red("unknown") as string;
      }

      console.log();
      console.log(chalk.bold("  Code Indexer Status"));
      console.log(`  Root:             ${chalk.cyan(rootDir)}`);
      console.log(
        `  Embedding:        ${chalk.cyan(`${config.embedding.provider}/${config.embedding.model}`)}`,
      );
      console.log(`  Store:            ${chalk.cyan(config.store.type)}`);
      if (config.store.type === "qdrant" && config.store.url) {
        console.log(`  Qdrant URL:       ${chalk.cyan(config.store.url)}`);
      }
      if (config.store.collectionName) {
        console.log(`  Collection:       ${chalk.cyan(config.store.collectionName)}`);
      }
      console.log(`  Vectors stored:   ${chalk.cyan(vectorCount)}`);
      console.log(`  Files on disk:    ${chalk.cyan(discoverableFiles.length)}`);
      console.log(`  Files indexed:    ${chalk.cyan(indexedFileCount)}`);
      console.log(`  Coverage:         ${chalk.cyan(coverage)}`);
      console.log(`  Include patterns: ${chalk.dim(config.include.join(", "))}`);
      console.log(`  Exclude patterns: ${chalk.dim(config.exclude.slice(0, 3).join(", "))}…`);
      console.log();
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── clear command ────────────────────────────────────────────────────────────

program
  .command("clear")
  .description("Clear the index (all or specific files)")
  .option("-d, --dir <path>", "Project root (for config loading)", ".")
  .option("-f, --file <path>", "File path or glob pattern to remove")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const rootDir = resolve(opts.dir);

    try {
      const config = await loadConfig(rootDir);
      const store = createStore(config.store, rootDir);
      await store.initialize(config.embedding.dimensions ?? 1536);

      if (opts.file) {
        // Delete specific file(s)
        const allPaths = await store.getIndexedFilePaths();
        const matched = allPaths.filter(
          (p) => p === opts.file || minimatch(p, opts.file),
        );

        if (matched.length === 0) {
          console.log(chalk.yellow(`No indexed files match "${opts.file}"`));
          return;
        }

        if (!opts.yes) {
          const rl = createInterface({ input: stdin, output: stdout });
          const answer = await rl.question(
            `Delete ${chalk.cyan(matched.length)} file(s) from index? (y/n) `,
          );
          rl.close();
          if (answer.trim().toLowerCase() !== "y") {
            console.log("Cancelled.");
            return;
          }
        }

        const spinner = ora(`Removing ${matched.length} file(s)…`).start();
        await store.deleteByFilePaths(matched);
        spinner.succeed(`Removed ${matched.length} file(s) from index`);

        for (const p of matched) {
          console.log(`  ${chalk.red("−")} ${p}`);
        }
      } else {
        // Drop entire index
        const vectorCount = await store.count();

        if (!opts.yes) {
          const rl = createInterface({ input: stdin, output: stdout });
          const answer = await rl.question(
            `This will delete all ${chalk.cyan(vectorCount)} vectors. Continue? (y/n) `,
          );
          rl.close();
          if (answer.trim().toLowerCase() !== "y") {
            console.log("Cancelled.");
            return;
          }
        }

        const spinner = ora("Clearing index…").start();
        await store.drop();
        spinner.succeed("Index cleared");
      }

      console.log();
    } catch (err) {
      if (err instanceof Error) {
        console.error(chalk.red(err.message || err.name));
        if (err.cause) console.error(chalk.dim(String(err.cause)));
      } else {
        console.error(chalk.red(String(err)));
      }
      process.exit(1);
    }
  });

// ── install command ─────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install Claude Code skills for code-indexer")
  .option("-g, --global", "Install to ~/.claude/skills/")
  .option("-l, --local", "Install to .claude/skills/ in current project")
  .action(installAction);

program.parse();
