import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvFile } from "./env-file.js";

const KEY = "WREN_ENV_FILE_TEST";
const dir = (stem: string) => mkdtempSync(join(tmpdir(), `wren-${stem}-`));
afterEach(() => {
  delete process.env[KEY];
});

describe("loadEnvFile", () => {
  it("walks up to the nearest .env and returns its directory", () => {
    const root = dir("env");
    writeFileSync(join(root, ".env"), `${KEY}=walked\n`);
    const deep = join(root, "a/b");
    mkdirSync(deep, { recursive: true });
    expect(loadEnvFile(deep)).toBe(root);
    expect(process.env[KEY]).toBe("walked");
  });

  it("inside the repo the walk still decides, even with a launcher root", () => {
    const repo = dir("repo");
    writeFileSync(join(repo, ".env"), `${KEY}=repo\n`);
    const deep = join(repo, "apps/cli");
    mkdirSync(deep, { recursive: true });
    expect(loadEnvFile(deep, repo)).toBe(repo);
    expect(process.env[KEY]).toBe("repo");
  });

  it("outside the repo the launcher's root wins over a stray .env above cwd", () => {
    const repo = dir("repo");
    writeFileSync(join(repo, ".env"), `${KEY}=repo\n`);
    const home = dir("home");
    writeFileSync(join(home, ".env"), `${KEY}=someone-elses\n`);
    const cwd = join(home, "Documents");
    mkdirSync(cwd);
    expect(loadEnvFile(cwd, repo)).toBe(repo);
    expect(process.env[KEY]).toBe("repo");
  });

  it("returns the start directory when there is no .env anywhere", () => {
    const bare = dir("bare");
    expect(loadEnvFile(bare)).toBe(bare);
    expect(process.env[KEY]).toBeUndefined();
  });
});
