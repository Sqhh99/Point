import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());
const capture = await import("../../src/main/capture.js");

/**
 * Windows-only: capture.test.ts skips its symlink hardening tests on Windows (creating symlinks needs
 * admin / developer mode). Directory junctions need no privilege, so they exercise the same
 * "captures dir leaves the workspace" checks there. File-level junctions do not exist, so every case
 * here is directory-level. POINT_JUNCTION_AS_SYMLINK=1 runs the same cases on POSIX with dir symlinks
 * (only used to sanity-check the tests locally; CI does not set it).
 */
const emulate = process.env.POINT_JUNCTION_AS_SYMLINK === "1";
const onWindows = process.platform === "win32" || emulate;
const link = (target: string, path: string) => symlinkSync(target, path, emulate ? "dir" : "junction");

// .native: Windows runners give 8.3 short temp paths.
const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG2 = Buffer.concat([PNG, Buffer.from([7])]);
const url = (sha: string) => `point-capture://${sha}/`;

/** Every file and directory under `dir`, relative, sorted. */
function tree(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix + e.name;
    return e.isDirectory() ? [rel + "/", ...tree(join(dir, e.name), rel + "/")] : [rel];
  }).sort();
}

describe.runIf(onWindows)("capture hardening against directory junctions (Windows)", () => {
  it("junctions can be created without admin on this runner (guard: these tests must not silently no-op)", () => {
    const a = tmp("point-jn-guard-");
    const target = join(a, "t");
    mkdirSync(target);
    link(target, join(a, "j"));
    writeFileSync(join(target, "f"), "x");
    expect(existsSync(join(a, "j", "f"))).toBe(true);
    expect(realpathSync.native(join(a, "j"))).toBe(realpathSync.native(target));
  });

  describe(".point/captures is a junction to an outside folder", () => {
    function setup() {
      const root = tmp("point-jn-ws-");
      const outside = tmp("point-jn-out-");
      // a real capture sitting outside, under the name the workspace would use
      const sha = capture.writeCapture(outside, PNG);
      mkdirSync(join(root, ".point"), { recursive: true });
      link(join(outside, ".point", "captures"), join(root, ".point", "captures"));
      return { root, outside, sha };
    }

    it("readCapture treats it as not found", () => {
      const { root, sha } = setup();
      expect(() => capture.readCapture(root, sha)).toThrow("截图不存在或已被删除");
      expect(() => capture.captureImage(root, sha)).toThrow("截图不存在或已被删除");
    });

    it("writeCapture refuses and writes nothing outside", () => {
      const { root, outside } = setup();
      const before = tree(outside);
      expect(() => capture.writeCapture(root, PNG2)).toThrow();
      expect(tree(outside)).toEqual(before);
    });

    it("writeCapture of bytes already present outside is still refused (no idempotent shortcut through the junction)", () => {
      const { root, outside } = setup();
      const before = tree(outside);
      expect(() => capture.writeCapture(root, PNG)).toThrow();
      expect(tree(outside)).toEqual(before);
    });

    it("point-capture:// returns 404", () => {
      const { root, sha } = setup();
      const r = capture.captureResponse(root, url(sha));
      expect(r.status).toBe(404);
      expect(r.headers.get("Content-Type")).not.toBe("image/png");
    });
  });

  describe(".point itself is a junction to an outside folder", () => {
    function setup() {
      const root = tmp("point-jn-ws2-");
      const outside = tmp("point-jn-out2-");
      const sha = capture.writeCapture(outside, PNG); // outside/.point/captures/<sha>.png
      link(join(outside, ".point"), join(root, ".point"));
      return { root, outside, sha };
    }

    it("readCapture treats it as not found", () => {
      const { root, sha } = setup();
      expect(() => capture.readCapture(root, sha)).toThrow("截图不存在或已被删除");
    });

    it("point-capture:// returns 404", () => {
      const { root, sha } = setup();
      expect(capture.captureResponse(root, url(sha)).status).toBe(404);
    });

    it("writeCapture refuses and no capture file lands outside", () => {
      const { root, outside } = setup();
      const pngsBefore = tree(outside).filter((f) => !f.endsWith("/"));
      expect(() => capture.writeCapture(root, PNG2)).toThrow();
      expect(tree(outside).filter((f) => !f.endsWith("/"))).toEqual(pngsBefore);
    });
  });

  describe(".point is a junction to an outside folder that has no captures dir yet", () => {
    // Bug: capturesDir(root, true) runs mkdirSync(<root>/.point/captures, { recursive: true }) BEFORE
    // checking that the real path stays inside the workspace, so the write is refused but an empty
    // `captures` folder has already been created in the outside target.
    it.fails("writeCapture creates nothing at all outside (not even an empty folder)", () => {
      const root = tmp("point-jn-ws3-");
      const outside = tmp("point-jn-out3-");
      link(outside, join(root, ".point"));
      expect(() => capture.writeCapture(root, PNG)).toThrow();
      expect(tree(outside)).toEqual([]);
    });
  });

  describe("junctions that stay inside the workspace are fine", () => {
    it("workspace reached through a junction (the whole root) still reads and writes", () => {
      const real = tmp("point-jn-real-");
      const alias = join(tmp("point-jn-alias-"), "ws");
      link(real, alias);
      const sha = capture.writeCapture(alias, PNG);
      expect(capture.readCapture(alias, sha).equals(PNG)).toBe(true);
      expect(capture.captureResponse(alias, url(sha)).status).toBe(200);
      expect(existsSync(join(real, ".point", "captures", `${sha}.png`))).toBe(true);
    });
  });
});
